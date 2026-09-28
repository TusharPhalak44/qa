import { SpeechClient } from '@google-cloud/speech';

let speechClientSingleton: SpeechClient | null = null;

export function getSpeechClient(): SpeechClient {
  if (speechClientSingleton) {
    return speechClientSingleton;
  }

  const speechOptions: Record<string, any> = {};

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (projectId) {
    speechOptions.projectId = projectId;
  }

  const credsJson = process.env.GOOGLE_CLOUD_CREDENTIALS_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsJson) {
    const trimmed = credsJson.trim();
    if (trimmed.startsWith('{')) {
      try {
        speechOptions.credentials = JSON.parse(trimmed);
      } catch (err) {
        console.error('Failed to parse SpeechClient credentials JSON:', err);
      }
    } else {
      speechOptions.keyFilename = trimmed;
    }
  }

  speechClientSingleton = new SpeechClient(speechOptions);
  return speechClientSingleton;
}

/**
 * Formats Google Speech-to-Text results with word-level timestamps and speaker diarization.
 */
export function formatGoogleSpeechResults(results: any[]): string {
  if (!results || results.length === 0) {
    return 'No speech recognized in audio file.';
  }

  // In Google Cloud Speech v1, the last result often contains the full diarized word array
  const lastResult = results[results.length - 1];
  const lastWords = lastResult?.alternatives?.[0]?.words || [];
  const hasDiarizationInLast = lastWords.some((w: any) => w.speakerTag && w.speakerTag > 0);

  let wordsToProcess: any[] = [];
  if (hasDiarizationInLast && lastWords.length > 5) {
    wordsToProcess = lastWords.filter((w: any) => w.speakerTag && w.speakerTag > 0);
  } else {
    for (const res of results) {
      const words = res.alternatives?.[0]?.words || [];
      for (const w of words) {
        if (w.speakerTag && w.speakerTag > 0) {
          wordsToProcess.push(w);
        }
      }
    }
  }

  if (wordsToProcess.length > 0) {
    const turns: { speaker: number; words: string[]; start: string; end: string }[] = [];
    let currentTurn: { speaker: number; words: string[]; start: string; end: string } | null = null;

    for (const w of wordsToProcess) {
      const speaker = w.speakerTag || 1;
      const wordText = w.word || '';
      const startSec = (parseFloat(w.startTime?.seconds || '0') + (w.startTime?.nanos || 0) / 1e9).toFixed(1);
      const endSec = (parseFloat(w.endTime?.seconds || '0') + (w.endTime?.nanos || 0) / 1e9).toFixed(1);

      if (!currentTurn || currentTurn.speaker !== speaker) {
        if (currentTurn) turns.push(currentTurn);
        currentTurn = { speaker, words: [wordText], start: startSec, end: endSec };
      } else {
        currentTurn.words.push(wordText);
        currentTurn.end = endSec;
      }
    }
    if (currentTurn) turns.push(currentTurn);

    if (turns.length > 0) {
      return turns
        .map(t => `[${t.start}s - ${t.end}s] [Speaker ${t.speaker}]: ${t.words.join(' ')}`)
        .join('\n\n');
    }
  }

  // Line-by-line utterance segmentation with timestamps
  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const alt = results[i].alternatives?.[0];
    const text = alt?.transcript?.trim();
    if (!text) continue;

    const words = alt?.words || [];
    let timeLabel = '';
    if (words.length > 0) {
      const firstWord = words[0];
      const lastWord = words[words.length - 1];
      const startSec = (parseFloat(firstWord.startTime?.seconds || '0') + (firstWord.startTime?.nanos || 0) / 1e9).toFixed(1);
      const endSec = (parseFloat(lastWord.endTime?.seconds || '0') + (lastWord.endTime?.nanos || 0) / 1e9).toFixed(1);
      timeLabel = `[${startSec}s - ${endSec}s] `;
    }

    lines.push(`${timeLabel}[Line ${i + 1}]: ${text}`);
  }

  return lines.join('\n\n') || 'No speech recognized in audio file.';
}

export interface StartAsyncRecognitionOptions {
  gcsUri: string;
  contentType: string;
  originalFileName?: string;
  language?: string;
}

/**
 * Initiates an asynchronous Google Cloud Speech-to-Text LongRunningRecognize operation.
 * Configures audio encoding correctly for WAV, MP3, FLAC, and OGG formats.
 * Returns the operationName immediately without holding open the Vercel Function.
 */
export async function startAsyncRecognition(options: StartAsyncRecognitionOptions): Promise<string> {
  const speechClient = getSpeechClient();
  const ext = (options.originalFileName || '').toLowerCase().split('.').pop() || '';
  const mime = (options.contentType || '').toLowerCase();

  const config: Record<string, any> = {
    languageCode: options.language || 'en-US',
    enableAutomaticPunctuation: true,
    enableWordTimeOffsets: true,
    useEnhanced: true,
    model: 'latest_long',
    diarizationConfig: {
      enableSpeakerDiarization: true,
      minSpeakerCount: 2,
      maxSpeakerCount: 3,
    },
    speechContexts: [
      {
        phrases: [
          'TGS Tech Info',
          'Learning Management System',
          'LMS',
          'Director',
          'VP',
          'Manager',
          'evaluate',
          'exploring',
          'zero to three months',
          'three to six months',
          'six months',
          'three months',
          'representative',
          'follow up',
        ],
        boost: 15.0,
      },
    ],
  };

  // Configure correct encoding per requirement 12
  if (ext === 'mp3' || mime.includes('mpeg') || mime.includes('mp3')) {
    config.encoding = 'MP3';
  } else if (ext === 'wav' || mime.includes('wav')) {
    // Standard WAV with RIFF header: Google Speech auto-detects sample rate and channel count when encoding is LINEAR16 or ENCODING_UNSPECIFIED
    config.encoding = 'LINEAR16';
  } else if (ext === 'flac' || mime.includes('flac')) {
    config.encoding = 'FLAC';
  } else if (ext === 'ogg' || mime.includes('ogg') || mime.includes('opus')) {
    config.encoding = 'OGG_OPUS';
  }

  const [operation] = await speechClient.longRunningRecognize({
    config,
    audio: { uri: options.gcsUri },
  });

  if (!operation.name) {
    throw new Error('Google Cloud Speech-to-Text did not return an operation name.');
  }

  return operation.name;
}

export interface AsyncRecognitionStatus {
  done: boolean;
  progressPercent: number;
  rawTranscript?: string;
  error?: string;
}

/**
 * Polls the status of an asynchronous Speech-to-Text operation.
 * Each poll request completes in milliseconds, perfectly fitting Vercel's Serverless Function model.
 */
export async function getAsyncRecognitionStatus(operationName: string): Promise<AsyncRecognitionStatus> {
  const speechClient = getSpeechClient();
  const operation = await speechClient.checkLongRunningRecognizeProgress(operationName);

  if (!operation.done) {
    const progressPercent = (operation.metadata as any)?.progressPercent || 0;
    return {
      done: false,
      progressPercent,
    };
  }

  if (operation.error) {
    return {
      done: true,
      progressPercent: 100,
      error: operation.error.message || 'Speech-to-Text recognition failed',
    };
  }

  const response = (operation as any).response;
  const results = response?.results || [];
  const rawTranscript = formatGoogleSpeechResults(results);

  return {
    done: true,
    progressPercent: 100,
    rawTranscript,
  };
}
