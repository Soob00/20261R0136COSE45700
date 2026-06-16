import { readFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const EXPERIMENT_ROOT = path.join(PROJECT_ROOT, 'experiments', 'accessory-feasibility');
const ALLOWED_PREFIXES = [
  path.join(EXPERIMENT_ROOT, 'outputs'),
  path.join(PROJECT_ROOT, 'public', 'models'),
];

function tryResolve(rawPath: string): string[] {
  return [
    path.resolve(PROJECT_ROOT, rawPath),
    path.resolve(EXPERIMENT_ROOT, rawPath),
  ];
}

function resolveFilePath(rawPath: string): string {
  for (const candidate of tryResolve(rawPath)) {
    if (ALLOWED_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
      return candidate;
    }
  }
  throw new Error('forbidden');
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.vrm') return 'application/octet-stream';
  return 'application/octet-stream';
}

export async function GET(request: NextRequest) {
  const rawPath = request.nextUrl.searchParams.get('path');
  if (!rawPath) {
    return NextResponse.json({ error: 'missing path' }, { status: 400 });
  }

  let resolved: string;
  try {
    resolved = resolveFilePath(rawPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'forbidden';
    const status = message === 'forbidden' ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    const data = await readFile(resolved);
    return new NextResponse(data, {
      status: 200,
      headers: {
        'content-type': contentTypeFor(resolved),
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'file_read_failed';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
