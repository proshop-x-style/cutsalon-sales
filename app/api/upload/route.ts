import { NextResponse } from 'next/server';
import { extractSuggestedTransactionFromFile } from '@/lib/ocr';

type OcrReadResult = {
  text: string;
  reason: string;
};

function toOcrErrorReason(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybeDetails = (error as { details?: unknown }).details;
    if (typeof maybeDetails === 'string' && maybeDetails.length > 0) {
      return maybeDetails;
    }

    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
      return maybeMessage;
    }
  }

  return 'OCR実行時に不明なエラーが発生しました。';
}

async function readOcrTextFromFile(file: File): Promise<OcrReadResult> {
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const { ImageAnnotatorClient } = await import('@google-cloud/vision');
    const client = new ImageAnnotatorClient();
    const [result] = await client.textDetection({
      image: { content: buffer },
    });

    return {
      text: result.fullTextAnnotation?.text ?? '',
      reason: '',
    };
  } catch (error) {
    console.warn('OCR processing failed, using fallback heuristic:', error);
    return {
      text: '',
      reason: toOcrErrorReason(error),
    };
  }
}

function isOcrAvailable() {
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function getOcrReason() {
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return 'GOOGLE_CLOUD_PROJECT と GOOGLE_APPLICATION_CREDENTIALS が未設定です。';
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return 'GOOGLE_APPLICATION_CREDENTIALS が未設定です。';
  }

  return '';
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const ocrRead = await readOcrTextFromFile(file);
  const suggestion = extractSuggestedTransactionFromFile(file.name, ocrRead.text);
  const ocrAvailable = isOcrAvailable();
  const ocrReason = ocrAvailable
    ? ocrRead.reason
    : getOcrReason();

  return NextResponse.json({
    ok: true,
    ocrAvailable,
    ocrReason,
    fileName: file.name,
    size: file.size,
    extractedText: ocrRead.text,
    suggestion,
  });
}
