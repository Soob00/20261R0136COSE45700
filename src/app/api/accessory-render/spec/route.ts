import { readFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const SPEC_ROOT = path.join(PROJECT_ROOT, 'experiments', 'accessory-feasibility', 'outputs');

function resolveSpecPath(rawPath: string): string {
  const candidate = path.resolve(PROJECT_ROOT, rawPath);
  if (!candidate.startsWith(SPEC_ROOT)) {
    throw new Error('forbidden');
  }
  if (!candidate.endsWith(`${path.sep}attachment_spec.json`) && !candidate.endsWith('/attachment_spec.json')) {
    throw new Error('forbidden');
  }
  return candidate;
}

export async function GET(request: NextRequest) {
  const rawPath = request.nextUrl.searchParams.get('path');
  if (!rawPath) {
    return NextResponse.json({ error: 'missing path' }, { status: 400 });
  }

  let resolved: string;
  try {
    resolved = resolveSpecPath(rawPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'forbidden';
    const status = message === 'forbidden' ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    const raw = await readFile(resolved, 'utf-8');
    return NextResponse.json(JSON.parse(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'spec_read_failed';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
