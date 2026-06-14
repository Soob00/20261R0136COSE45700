import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { existsSync } from 'fs';

const UPLOAD_DIR = path.join(process.cwd(), '.next', 'temp', 'accessory-jobs');

async function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function handleVarcoUpload(imageBuffer: Buffer, filename: string): Promise<string> {
  const apiKey = process.env.VARCO_API_KEY;
  if (!apiKey) throw new Error('VARCO_API_KEY is not set');

  const formData = new FormData();
  // We need to convert the buffer into a Blob for FormData
  const blob = new Blob([imageBuffer], { type: 'image/png' });
  formData.append('image', blob, filename);

  const res = await fetch('https://openapi.ai.nc.com/3d/varco/v1/image-to-3d', {
    method: 'POST',
    headers: {
      'openapi_key': apiKey,
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Varco API Submit Error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.requestId;
}

async function pollVarcoStatus(requestId: string): Promise<string> {
  const apiKey = process.env.VARCO_API_KEY;
  if (!apiKey) throw new Error('VARCO_API_KEY is not set');

  const timeout = 300; // 5 minutes
  const interval = 10;
  let elapsed = 0;

  while (elapsed < timeout) {
    const res = await fetch(`https://openapi.ai.nc.com/inference/result/${requestId}`, {
      headers: { 'openapi_key': apiKey },
    });

    if (res.status === 200) {
      const data = await res.json();
      if (data.status === 'succeeded') {
        return data.model_url;
      }
    } else if (res.status === 500) {
      const text = await res.text();
      throw new Error(`Varco Task Failed: ${text}`);
    } else if (res.status !== 202) {
      const text = await res.text();
      throw new Error(`Varco Task Error: ${res.status} ${text}`);
    }

    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    elapsed += interval;
  }

  throw new Error(`Varco Polling timeout after ${timeout}s`);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as string; // 'glb' or 'image'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    await ensureDir(UPLOAD_DIR);
    const jobId = crypto.randomUUID();
    const jobDir = path.join(UPLOAD_DIR, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    if (type === 'glb') {
      const glbPath = path.join(jobDir, 'accessory.glb');
      const arrayBuffer = await file.arrayBuffer();
      await fs.writeFile(glbPath, Buffer.from(arrayBuffer));

      return NextResponse.json({
        ok: true,
        type: 'glb',
        url: `/api/accessory-generate/file?path=${encodeURIComponent(glbPath)}`,
      });
    } else if (type === 'image') {
      // 1. Submit to Varco
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const requestId = await handleVarcoUpload(buffer, file.name);

      // 2. Poll for completion
      const modelUrl = await pollVarcoStatus(requestId);

      // 3. Download GLB
      const glbRes = await fetch(modelUrl);
      if (!glbRes.ok) throw new Error('Failed to download GLB from Varco');
      
      const glbBuffer = await glbRes.arrayBuffer();
      const glbPath = path.join(jobDir, 'generated.glb');
      await fs.writeFile(glbPath, Buffer.from(glbBuffer));

      return NextResponse.json({
        ok: true,
        type: 'image',
        url: `/api/accessory-generate/file?path=${encodeURIComponent(glbPath)}`,
      });
    } else {
      return NextResponse.json({ error: 'Invalid type. Use "glb" or "image".' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[Accessory Generate API Error]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
