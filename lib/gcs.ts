import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';

// Supported audio MIME types and their standard extensions
export const ALLOWED_AUDIO_TYPES: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'mp4',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

export const MAX_AUDIO_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB (ample for 3-15 min audio)

let storageClientSingleton: Storage | null = null;

export function getStorageClient(): Storage {
  if (storageClientSingleton) {
    return storageClientSingleton;
  }

  const storageOptions: Record<string, unknown> = {};

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (projectId) {
    storageOptions.projectId = projectId;
  }

  // Support credentials via GOOGLE_APPLICATION_CREDENTIALS (file path or JSON string)
  // or GOOGLE_CLOUD_CREDENTIALS_JSON (direct raw JSON in Vercel environment variables)
  const credsJson = process.env.GOOGLE_CLOUD_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsJson) {
    const trimmed = credsJson.trim();
    if (trimmed.startsWith('{')) {
      try {
        storageOptions.credentials = JSON.parse(trimmed);
      } catch (err) {
        console.error('Failed to parse Google credentials JSON:', err);
      }
    } else {
      storageOptions.keyFilename = trimmed;
    }
  }

  storageClientSingleton = new Storage(storageOptions);
  return storageClientSingleton;
}

export function getGCSBucketName(): string {
  const bucketName = process.env.GCS_BUCKET_NAME?.trim();
  if (!bucketName) {
    throw new Error(
      'GCS_BUCKET_NAME environment variable is not configured. Please set GCS_BUCKET_NAME in your environment.'
    );
  }
  return bucketName;
}

export interface SignedUrlRequest {
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface SignedUrlResult {
  uploadUrl: string;
  objectName: string;
  gcsUri: string;
  contentType: string;
  expiresInSeconds: number;
  bucketName: string;
}

/**
 * Generates a short-lived V4 Signed URL for direct browser-to-GCS upload via HTTP PUT.
 * The audio file bytes flow directly from browser to GCS, never passing through Vercel Functions.
 */
export async function generateV4UploadSignedUrl(request: SignedUrlRequest): Promise<SignedUrlResult> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);

  // 1. Validate file size
  if (!request.fileSize || request.fileSize <= 0) {
    throw new Error('Invalid file size: Audio file cannot be empty (0 bytes).');
  }
  if (request.fileSize > MAX_AUDIO_FILE_SIZE_BYTES) {
    throw new Error(
      `File size exceeds maximum allowed limit of ${MAX_AUDIO_FILE_SIZE_BYTES / (1024 * 1024)} MB.`
    );
  }

  // 2. Validate and normalize MIME type
  const rawType = (request.fileType || '').toLowerCase().trim();
  const fileExt = (request.fileName || '').toLowerCase().split('.').pop() || '';

  let normalizedType = rawType;
  if (!ALLOWED_AUDIO_TYPES[normalizedType]) {
    // Attempt fallback from file extension
    if (fileExt === 'mp3') normalizedType = 'audio/mpeg';
    else if (fileExt === 'wav') normalizedType = 'audio/wav';
    else if (fileExt === 'flac') normalizedType = 'audio/flac';
    else if (fileExt === 'ogg') normalizedType = 'audio/ogg';
    else if (fileExt === 'm4a') normalizedType = 'audio/m4a';
    else {
      throw new Error(
        `Unsupported audio file type "${request.fileType}". Supported formats: WAV, MP3, FLAC, M4A, OGG.`
      );
    }
  }

  const determinedExt = ALLOWED_AUDIO_TYPES[normalizedType] || fileExt || 'wav';

  // 3. Generate a secure, non-guessable, sanitized object name under audio-uploads/
  const timestamp = Date.now();
  const randomUuid = crypto.randomUUID();
  const sanitizedOriginalName = request.fileName
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .slice(0, 30);
  const objectName = `audio-uploads/${timestamp}-${randomUuid}-${sanitizedOriginalName}.${determinedExt}`;

  const file = bucket.file(objectName);
  const expiresInSeconds = 15 * 60; // 15 minutes

  // 4. Generate short-lived v4 signed URL for PUT
  const [uploadUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInSeconds * 1000,
    contentType: normalizedType,
  });

  return {
    uploadUrl,
    objectName,
    gcsUri: `gs://${bucketName}/${objectName}`,
    contentType: normalizedType,
    expiresInSeconds,
    bucketName,
  };
}

export interface ValidatedGCSObject {
  objectName: string;
  gcsUri: string;
  bucketName: string;
  size: number;
  contentType: string;
  created: string;
}

/**
 * Validates the uploaded object in GCS before invoking Speech-to-Text.
 * Enforces ownership, path confinement, existence, file size, and audio MIME type.
 * Rejects arbitrary client-supplied GCS URIs.
 */
export async function validateGCSObject(objectName: string): Promise<ValidatedGCSObject> {
  if (!objectName || typeof objectName !== 'string') {
    throw new Error('Invalid GCS object name provided.');
  }

  // Security check 1: Enforce confined namespace and prevent directory traversal
  const trimmed = objectName.trim();
  if (
    !trimmed.startsWith('audio-uploads/') ||
    trimmed.includes('..') ||
    trimmed.includes('\\') ||
    trimmed.includes('//')
  ) {
    throw new Error('Access denied: Unauthorized or malformed GCS object path.');
  }

  // Security check 2: Regex check for safe characters
  const safeRegex = /^audio-uploads\/[0-9a-zA-Z._-]+$/;
  if (!safeRegex.test(trimmed)) {
    throw new Error('Access denied: Object name contains invalid characters.');
  }

  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(trimmed);

  // Security check 3: Verify the object actually exists in our private bucket
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`The uploaded object "${trimmed}" does not exist in bucket "${bucketName}".`);
  }

  // Security check 4: Inspect object metadata
  const [metadata] = await file.getMetadata();
  const size = parseInt(String(metadata.size || '0'), 10);

  if (size <= 0) {
    throw new Error('Uploaded audio file is empty (0 bytes).');
  }

  if (size > MAX_AUDIO_FILE_SIZE_BYTES) {
    throw new Error(
      `Uploaded audio file size (${(size / (1024 * 1024)).toFixed(1)} MB) exceeds allowed limit of ${MAX_AUDIO_FILE_SIZE_BYTES / (1024 * 1024)} MB.`
    );
  }

  const contentType = (metadata.contentType || '').toLowerCase().trim();
  const isAllowedType = ALLOWED_AUDIO_TYPES[contentType] !== undefined || contentType.startsWith('audio/');
  if (!isAllowedType) {
    throw new Error(
      `Invalid object MIME type "${contentType}". Only verified audio recordings are permitted.`
    );
  }

  return {
    objectName: trimmed,
    gcsUri: `gs://${bucketName}/${trimmed}`,
    bucketName,
    size,
    contentType,
    created: String(metadata.timeCreated || new Date().toISOString()),
  };
}

/**
 * Cleans up temporary audio recording from GCS after processing.
 */
export async function deleteGCSObject(objectName: string): Promise<void> {
  try {
    const bucketName = getGCSBucketName();
    const storage = getStorageClient();
    const file = storage.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (exists) {
      await file.delete();
      console.log(`Successfully cleaned up GCS object: ${objectName}`);
    }
  } catch (err) {
    console.warn(`Failed to cleanup GCS object ${objectName}:`, err);
  }
}

/**
 * Gets current CORS configuration of the GCS bucket.
 */
export async function getBucketCors(): Promise<unknown[]> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const [metadata] = await storage.bucket(bucketName).getMetadata();
  return metadata.cors || [];
}

/**
 * Applies CORS configuration to the GCS bucket for Vercel production and localhost.
 */
export async function setBucketCors(customOrigins?: string[]): Promise<unknown> {
  const bucketName = getGCSBucketName();
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);

  const origins = Array.from(
    new Set([
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:8080',
      'https://*.vercel.app',
      ...(customOrigins || []),
    ])
  );

  const corsConfig = [
    {
      origin: origins,
      method: ['GET', 'PUT', 'POST', 'OPTIONS', 'HEAD'],
      responseHeader: [
        'Content-Type',
        'Access-Control-Allow-Origin',
        'x-goog-resumable',
        'x-goog-meta-*',
      ],
      maxAgeSeconds: 3600,
    },
  ];

  await bucket.setCorsConfiguration(corsConfig);
  return corsConfig;
}

