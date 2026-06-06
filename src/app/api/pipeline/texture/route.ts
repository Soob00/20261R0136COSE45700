import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile, mkdir, rm, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = process.cwd();
const PIPELINE_DIR = join(PROJECT_ROOT, 'src', 'pipeline');
const DEBUG_DIR = join(PROJECT_ROOT, 'debug', 'texture');
const FACE_FEATURE_DIR = join(PROJECT_ROOT, 'face-feature');
const KANOSAWA_DIR = join(PIPELINE_DIR, 'kanosawa');
const TEXTURES_DIR = join(PIPELINE_DIR, 'assets', 'textures');

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Resolve Python interpreter from env var or fallback to system python3 */
function getPython(): string {
  return process.env.PIPELINE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

/** Pipeline output filename → VRM material slot regex mapping */
const TEXTURE_SLOT_MAP: Record<string, RegExp> = {
  'BaseTexture_Generate_Face.png': /face|skin/i,
  'BaseTexture_Generate_Eyebrow.png': /eyebrow|brow/i,
  'BaseTexture_Generate_Eyeline.png': /eyeline|eyelash|eyelid/i,
  'BaseTexture_Generate_Pupil.png': /eye|iris|pupil/i,
  'BaseTexture_Static_EyeWhite.png': /sclera|eyewhite/i,
  'BaseTexture_Static_EyeHighlight.png': /highlight/i,
  'BaseTexture_Static_MouthInside.png': /mouth/i,
};

async function runPython(
  script: string,
  args: string[],
  cwd: string,
  label: string,
): Promise<string> {
  const python = getPython();
  console.log(`[TexturePipeline] Running ${label} with ${python}...`);
  const { stdout, stderr } = await execFileAsync(python, [script, ...args], {
    cwd,
    timeout: TIMEOUT_MS,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  if (stderr) console.warn(`[TexturePipeline] ${label} stderr:`, stderr);
  if (stdout) console.log(`[TexturePipeline] ${label} stdout:`, stdout);
  return stdout;
}

export async function POST(request: NextRequest) {
  const workDir = join(tmpdir(), `texture-pipeline-${randomUUID()}`);

  try {
    // Parse multipart form data
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;

    if (!imageFile) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    // Create work directory
    await mkdir(workDir, { recursive: true });

    // Save uploaded image
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    const imagePath = join(workDir, 'input.png');
    await writeFile(imagePath, imageBuffer);

    // Step 1: kanosawa landmarks 먼저 추출 — extract_features.py의 OpenCV 색상 샘플링에 필요
    const landmarksJson = join(workDir, 'landmarks.json');
    const landmarkOutput = join(workDir, 'landmarks_annotated.png');
    try {
      await runPython(
        join(KANOSAWA_DIR, 'extract_landmarks.py'),
        [imagePath, landmarkOutput, '--landmarks_json', landmarksJson],
        KANOSAWA_DIR,
        'extract_landmarks',
      );
    } catch (e) {
      console.warn('[TexturePipeline] Landmark extraction failed, iris color sampling will use Gemini only:', e);
    }

    // Step 2: Extract features (Gemini API + OpenCV iris sampling with landmarks)
    const featuresJson = join(workDir, 'features.json');
    await runPython(
      join(PIPELINE_DIR, 'extract_features.py'),
      ['--image', imagePath, '--output', featuresJson],
      PIPELINE_DIR,
      'extract_features',
    );

    // Step 3: ADF face-keys + texture adjustment (parallel)
    const outputDir = join(workDir, 'output');
    const faceKeysJson = join(workDir, 'face_keys.json');
    const hairMatchJson = join(workDir, 'hair_match.json');

    const [, faceKeysInitResult] = await Promise.allSettled([
      runPython(
        join(PIPELINE_DIR, 'adjust_texture.py'),
        ['--features', featuresJson, '--input_dir', TEXTURES_DIR, '--output_dir', outputDir],
        PIPELINE_DIR,
        'adjust_texture',
      ),
      runPython(
        join(FACE_FEATURE_DIR, 'run_extract.py'),
        ['--image', imagePath, '--output', faceKeysJson, '--features', featuresJson],
        FACE_FEATURE_DIR,
        'face-feature run_extract (ADF)',
      ),
    ]);

    // Check if ADF face-keys succeeded
    let adfOk = false;
    if (faceKeysInitResult.status === 'fulfilled' && existsSync(faceKeysJson)) {
      try {
        const fk = JSON.parse(await readFile(faceKeysJson, 'utf-8'));
        adfOk = fk.status === 'ok' && !!fk.adf_landmarks;
      } catch { /* parse error → treat as failed */ }
    }

    // Step 3: Hairstyle analysis — ADF path or kanosawa fallback
    if (adfOk) {
      console.log('[TexturePipeline] ADF succeeded, using ADF landmarks for hairstyle');
      try {
        await runPython(
          join(PIPELINE_DIR, 'analyze_hairstyle.py'),
          ['--image', imagePath, '--face-keys', faceKeysJson, '--features', featuresJson, '--output', hairMatchJson],
          PIPELINE_DIR,
          'analyze_hairstyle (ADF)',
        );
      } catch (e) {
        console.warn('[TexturePipeline] Hairstyle analysis failed:', e);
      }
    } else {
      console.log('[TexturePipeline] ADF failed, using kanosawa landmarks (already extracted in Step 1)');

      // Retry face-keys with kanosawa + hairstyle (parallel)
      await Promise.allSettled([
        runPython(
          join(FACE_FEATURE_DIR, 'run_extract.py'),
          ['--image', imagePath, '--output', faceKeysJson, '--features', featuresJson, '--landmarks', landmarksJson],
          FACE_FEATURE_DIR,
          'run_extract (kanosawa fallback)',
        ),
        runPython(
          join(PIPELINE_DIR, 'analyze_hairstyle.py'),
          ['--image', imagePath, '--landmarks', landmarksJson, '--features', featuresJson, '--output', hairMatchJson],
          PIPELINE_DIR,
          'analyze_hairstyle (kanosawa)',
        ),
      ]);
    }

    // Read generated textures and encode as base64
    const textures: Record<string, string> = {};

    for (const [filename] of Object.entries(TEXTURE_SLOT_MAP)) {
      const texturePath = join(outputDir, filename);
      if (!existsSync(texturePath)) continue;

      const data = await readFile(texturePath);
      const base64 = data.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;

      // Use the filename (without extension) as key, store the regex source for frontend matching
      const slotKey = filename.replace('.png', '');
      textures[slotKey] = dataUrl;
    }

    // Read features, landmarks, hair match, and face-keys for frontend use
    let features: unknown = null;
    let landmarks: unknown = null;
    let hairMatch: unknown = null;
    let faceKeys: unknown = null;
    try {
      if (existsSync(featuresJson)) {
        features = JSON.parse(await readFile(featuresJson, 'utf-8'));
      }
      if (existsSync(landmarksJson)) {
        landmarks = JSON.parse(await readFile(landmarksJson, 'utf-8'));
      }
      if (existsSync(hairMatchJson)) {
        hairMatch = JSON.parse(await readFile(hairMatchJson, 'utf-8'));
        console.log('[TexturePipeline] Hair match result:', JSON.stringify(hairMatch));
      }
      if (existsSync(faceKeysJson)) {
        faceKeys = JSON.parse(await readFile(faceKeysJson, 'utf-8'));
        console.log('[TexturePipeline] Face keys extracted');
      }
    } catch {
      // non-critical
    }

    // Save debug output (fire-and-forget — don't block response)
    const debugTs = new Date().toISOString().replace(/[:.]/g, '-');
    const debugOut = join(DEBUG_DIR, debugTs);
    cp(workDir, debugOut, { recursive: true })
      .then(() => console.log(`[TexturePipeline] Debug saved: ${debugOut}`))
      .catch((e) => console.warn('[TexturePipeline] Debug save failed:', e));

    return NextResponse.json({ textures, features, landmarks, hairMatch, faceKeys });
  } catch (err) {
    console.error('[TexturePipeline] Error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Cleanup temp directory
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
